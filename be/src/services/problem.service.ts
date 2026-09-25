import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import type { ProblemCategory } from "../constants/enums/index.js";
import { getStorageProvider } from "../integrations/storage/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { bookingRef, rupees } from "../lib/format.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/security-log.js";
import { notify } from "./notification.service.js";

/**
 * "I can't use what I paid for" (Phase 4).
 *
 * A driver files one report per booking; support resolves it, with or
 * without the booking's money back. The booking itself keeps its status --
 * a report is a claim, not a cancellation -- and reads as "Under review"
 * while the report is open.
 */

/** Reportable from shortly before arrival until a day after leaving. */
const OPEN_BEFORE_START_MS = 60 * 60_000;
const OPEN_AFTER_END_MS = 24 * 60 * 60_000;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** How the host's alert names each kind. Never the driver's own words. */
const CATEGORY_LABELS: Record<ProblemCategory, string> = {
  CANT_FIND: "couldn't find the parking",
  OCCUPIED: "found the space occupied",
  GATE_LOCKED: "found the gate locked",
  NOT_AS_LISTED: "says the parking doesn't match the listing",
  HOST_UNRESPONSIVE: "couldn't reach you",
  OTHER: "reported a problem",
};

const reportView = {
  id: true,
  bookingId: true,
  category: true,
  details: true,
  photoUrl: true,
  status: true,
  refunded: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
} satisfies Prisma.ProblemReportSelect;

const reportable = {
  status: true,
  listingId: true,
  extendsBookingId: true,
  startsAt: true,
  endsAt: true,
  payment: { select: { status: true, amount: true } },
  extensions: { where: { status: "CONFIRMED" }, select: { endsAt: true } },
  problem: { select: reportView },
  listing: { select: { name: true, hostProfile: { select: { userId: true } } } },
  driver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BookingSelect;

type ReportableRow = Prisma.BookingGetPayload<{ select: typeof reportable }>;

function whyNotReportable(row: ReportableRow, now: Date): string | null {
  if (!row.listingId || row.extendsBookingId) return "This booking can't be reported here. Contact support.";
  if (row.status !== "CONFIRMED" && row.status !== "COMPLETED") return "Only a confirmed booking can be reported.";
  if (row.payment?.status !== "CAPTURED") return "Only a paid booking can be reported.";
  if (!row.startsAt || !row.endsAt) return "This booking can't be reported here. Contact support.";

  const end = row.extensions.reduce((latest, ext) => (ext.endsAt && ext.endsAt > latest ? ext.endsAt : latest), row.endsAt);
  if (now.getTime() < row.startsAt.getTime() - OPEN_BEFORE_START_MS) {
    return "You can report a problem from an hour before your parking starts.";
  }
  if (now.getTime() > end.getTime() + OPEN_AFTER_END_MS) {
    return "It's been more than a day since this parking ended. Contact support.";
  }
  return null;
}

async function loadOwned(bookingId: string, driverId: string) {
  // driverId in the WHERE: someone else's booking and a missing one look alike.
  const row = await prisma.booking.findFirst({ where: { id: bookingId, driverId }, select: reportable });
  if (!row) throw notFound("Booking not found");
  return row;
}

function photoPrefix(bookingId: string) {
  return `problem-photos/${bookingId}`;
}

/** A photo for the report: images only, size-capped, and only under this booking's folder. */
export async function presignPhoto(
  bookingId: string,
  driverId: string,
  input: { contentType: string; contentLength: number }
) {
  const row = await loadOwned(bookingId, driverId);
  const refusal = row.problem ? "This booking already has a report." : whyNotReportable(row, new Date());
  if (refusal) throw conflict(refusal);

  if (!IMAGE_CONTENT_TYPES.includes(input.contentType)) {
    throw badRequest(`Unsupported file type. Allowed: ${IMAGE_CONTENT_TYPES.join(", ")}`);
  }
  if (input.contentLength > env.MAX_UPLOAD_BYTES) {
    throw badRequest(`File is too large. Maximum ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }

  return getStorageProvider().presignUpload({
    prefix: photoPrefix(bookingId),
    contentType: input.contentType,
    contentLength: input.contentLength,
  });
}

export async function create(
  bookingId: string,
  driverId: string,
  input: { category: ProblemCategory; details?: string; photoUrl?: string }
) {
  const now = new Date();
  const row = await loadOwned(bookingId, driverId);

  if (row.problem) {
    throw Object.assign(conflict("You've already reported a problem with this booking."), { extra: { report: row.problem } });
  }
  const refusal = whyNotReportable(row, now);
  if (refusal) throw conflict(refusal);

  // Minted by us, for this booking. Any other URL -- another booking's photo,
  // a spot photo, the open internet -- is refused.
  if (input.photoUrl) {
    const storage = getStorageProvider();
    if (!storage.ownsUrl(input.photoUrl) || !input.photoUrl.includes(`/${photoPrefix(bookingId)}/`)) {
      throw badRequest("The photo must be uploaded through the provided upload URL");
    }
  }

  try {
    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.problemReport.create({
        data: {
          bookingId,
          driverId,
          listingId: row.listingId!,
          category: input.category,
          details: input.details ?? null,
          photoUrl: input.photoUrl ?? null,
        },
        select: reportView,
      });

      await notify(
        driverId,
        "PROBLEM_LOGGED",
        {
          title: `Problem reported · ${bookingRef(bookingId)}`,
          body: "We've alerted the host. Support usually reviews a report within 30 minutes during the day.",
          bookingId,
          listingId: row.listingId!,
          dedupeKey: `problem:${created.id}`,
        },
        tx
      );

      const hostUserId = row.listing?.hostProfile?.userId;
      if (hostUserId) {
        const driver = row.driver.firstName
          ? `${row.driver.firstName}${row.driver.lastName ? ` ${row.driver.lastName.charAt(0).toUpperCase()}.` : ""}`
          : "A driver";
        await notify(
          hostUserId,
          "HOST_PROBLEM_REPORTED",
          {
            title: `Problem at ${row.listing?.name ?? "your space"}`,
            body: `${driver} ${CATEGORY_LABELS[input.category]} (${bookingRef(bookingId)}). Support will be in touch.`,
            bookingId,
            listingId: row.listingId!,
            dedupeKey: `hostproblem:${created.id}`,
          },
          tx
        );
      }

      return created;
    });

    audit("PROBLEM_REPORTED", { userId: driverId, bookingId, reportId: report.id, category: input.category });
    return report;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.problemReport.findUnique({ where: { bookingId }, select: reportView });
      throw Object.assign(conflict("You've already reported a problem with this booking."), { extra: { report: existing } });
    }
    throw error;
  }
}

export async function getForDriver(bookingId: string, driverId: string) {
  const report = await prisma.problemReport.findFirst({ where: { bookingId, driverId }, select: reportView });
  if (!report) throw notFound("No report for this booking");
  return report;
}

// ---------- Support ----------

export async function listForAdmin(status: "OPEN" | "RESOLVED" = "OPEN") {
  return prisma.problemReport.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    select: {
      ...reportView,
      listing: { select: { id: true, name: true } },
      booking: { select: { startsAt: true, endsAt: true, payment: { select: { status: true, amount: true } } } },
    },
  });
}

/**
 * Support's decision. With a refund, the booking's captured amount goes back
 * in full -- the driver couldn't use what they paid for -- written in the same
 * transaction that closes the report. `Refund.bookingId` is unique, so a
 * booking can't be refunded twice by two decisions or by a report and a
 * cancellation.
 */
export async function resolve(reportId: string, adminUserId: string, input: { refund: boolean; note?: string }) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const report = await tx.problemReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        status: true,
        bookingId: true,
        driverId: true,
        listingId: true,
        booking: { select: { payment: { select: { status: true, amount: true } }, refund: { select: { id: true } } } },
      },
    });
    if (!report) throw notFound("Report not found");
    if (report.status !== "OPEN") throw conflict("This report has already been resolved.");

    const changed = await tx.problemReport.updateMany({
      where: { id: reportId, status: "OPEN" },
      data: {
        status: "RESOLVED",
        refunded: input.refund,
        resolutionNote: input.note ?? null,
        resolvedAt: now,
        resolvedBy: adminUserId,
      },
    });
    if (changed.count === 0) throw conflict("This report has already been resolved.");

    let refundAmount: Prisma.Decimal | null = null;
    if (input.refund) {
      const payment = report.booking.payment;
      if (payment?.status !== "CAPTURED") throw conflict("Nothing was paid for this booking.");
      if (report.booking.refund) throw conflict("This booking has already been refunded.");
      refundAmount = payment.amount;
      await tx.refund.create({ data: { bookingId: report.bookingId, amount: payment.amount, policy: "PROBLEM_REPORT" } });
    }

    await notify(
      report.driverId,
      "PROBLEM_RESOLVED",
      {
        title: input.refund ? "Your report was upheld" : "Your report was reviewed",
        body: input.refund
          ? `${rupees(refundAmount!)} for ${bookingRef(report.bookingId)} is on its way back to how you paid.`
          : `Support reviewed ${bookingRef(report.bookingId)} and closed it without a refund.`,
        bookingId: report.bookingId,
        listingId: report.listingId,
        dedupeKey: `resolved:${report.id}`,
      },
      tx
    );
    if (input.refund) {
      await notify(
        report.driverId,
        "REFUND_STARTED",
        {
          title: "Refund started",
          body: `${rupees(refundAmount!)} for ${bookingRef(report.bookingId)}. Usually 5–7 working days, depending on your bank.`,
          bookingId: report.bookingId,
          dedupeKey: `refund:${report.bookingId}`,
        },
        tx
      );
    }

    return { reportId: report.id, bookingId: report.bookingId, refunded: input.refund, amount: refundAmount?.toString() ?? null };
  });

  audit("PROBLEM_RESOLVED", { userId: adminUserId, ...result });
  return result;
}
