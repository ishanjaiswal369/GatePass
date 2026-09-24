/**
 * Dummy host spots around one point, for trying the driver search and
 * checkout by hand.
 *
 *   npm run seed:spots
 *
 * Centred on the Unnao test spot (Bara Chauraha, near the SBI main branch).
 * The spots differ on purpose, so each part of the search has something to
 * say yes or no to: distance (one sits outside the default 5 km, to exercise
 * "search within 15 km"), opening hours (all day, weekdays only, evenings,
 * weekends), and which vehicles are priced (car only, car and bike, bike
 * only -- the last one is what a car driver sees refused at checkout).
 *
 * Re-runnable. Every listing has a fixed id and is upserted, and its rates
 * and hours are replaced wholesale, so running it again resets the spots
 * without orphaning any booking already made against them. Nothing it did
 * not create is touched.
 *
 * All of it belongs to one seed host with no password and an address that
 * receives no mail, so nobody can sign in as them -- and the seeded spots
 * stay out of any real account's Host tab.
 *
 * Five of the seven get a cover image from scripts/seed-photos, copied into
 * local storage the way an upload would land. They are illustrations labelled
 * "Placeholder image", not photographs pretending to be these places. Two are
 * left without one on purpose, so the no-photo card is on screen as well.
 */
import "dotenv/config";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";

const PHOTO_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-photos");
// The same two settings LocalStorageProvider reads, with its defaults, so a
// seeded photo sits exactly where an uploaded one would and is served by the
// same route.
const STORAGE_DIR = process.env.STORAGE_LOCAL_DIR ?? "uploads";
const STORAGE_BASE_URL = process.env.STORAGE_PUBLIC_BASE_URL ?? "http://localhost:3000/uploads";

const CENTRE = { latitude: 26.544690259350563, longitude: 80.48458390470928 };

const HOST_EMAIL = "seed-host@gatepass.local";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];
const WEEKEND = [0, 6];

const h = (hours: number) => hours * 60;

interface Window {
  days: number[];
  from: number;
  to: number;
}

interface SeedSpot {
  /** Fixed, so a re-run updates rather than duplicates. */
  id: string;
  name: string;
  spaceType: "DRIVEWAY" | "GARAGE" | "CAR_PARK";
  addressLine: string;
  /** Where it sits relative to the centre. */
  km: number;
  bearingDeg: number;
  rates: { CAR?: number; BIKE?: number };
  hours: Window[];
  access: string;
  /** A file in scripts/seed-photos, or none to show the no-photo card. */
  photo?: string;
}

const SPOTS: SeedSpot[] = [
  {
    id: "5eed0000-0000-4000-8000-000000000001",
    photo: "driveway.jpg",
    name: "Driveway behind the SBI branch",
    spaceType: "DRIVEWAY",
    addressLine: "House 14, lane behind SBI main branch, Bara Chauraha",
    km: 0.4,
    bearingDeg: 0,
    rates: { CAR: 30, BIKE: 10 },
    hours: [{ days: EVERY_DAY, from: h(7), to: h(22) }],
    access: "Blue gate. Ring the bell once; the latch lifts from inside.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000002",
    photo: "garage.jpg",
    name: "Covered garage, Ab Nagar",
    spaceType: "GARAGE",
    addressLine: "Plot 7, second lane, Ab Nagar",
    km: 0.9,
    bearingDeg: 90,
    rates: { CAR: 40 },
    hours: [{ days: MON_TO_SAT, from: h(8), to: h(20) }],
    access: "Shutter is left half-open during listed hours. Duck under, park nose-in.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000003",
    photo: "carpark.jpg",
    name: "Apartment car park bay 12",
    spaceType: "CAR_PARK",
    addressLine: "Shanti Residency, basement bay 12",
    km: 1.5,
    bearingDeg: 225,
    rates: { CAR: 20, BIKE: 8 },
    hours: [{ days: EVERY_DAY, from: 0, to: h(24) }],
    access: "Tell the guard you are parking in bay 12. It is marked in yellow.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000004",
    name: "Office basement, after hours",
    spaceType: "CAR_PARK",
    addressLine: "Basement, Gupta Complex, station road",
    km: 2.2,
    bearingDeg: 315,
    rates: { CAR: 25 },
    hours: [
      { days: WEEKDAYS, from: h(18), to: h(24) },
      { days: WEEKEND, from: 0, to: h(24) },
    ],
    access: "Use the ramp on the left. The office bays are free after 6pm.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000005",
    photo: "market.jpg",
    name: "Bike stand by the market",
    spaceType: "DRIVEWAY",
    addressLine: "Shop 3 forecourt, main market road",
    km: 3.0,
    bearingDeg: 180,
    rates: { BIKE: 5 },
    hours: [{ days: EVERY_DAY, from: h(9), to: h(21) }],
    access: "Park against the left wall. Chain is optional; the shop is staffed.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000006",
    photo: "colony.jpg",
    name: "Gated driveway, residential colony",
    spaceType: "DRIVEWAY",
    addressLine: "C-21, Awas Vikas colony",
    km: 4.3,
    bearingDeg: 70,
    rates: { CAR: 15 },
    hours: [{ days: WEEKDAYS, from: h(9), to: h(18) }],
    access: "Colony guard has your booking. Show the name on it at the barrier.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000007",
    name: "Highway-side farmhouse parking",
    spaceType: "DRIVEWAY",
    addressLine: "Farmhouse 2, Lucknow road",
    km: 8.5,
    bearingDeg: 20,
    rates: { CAR: 10 },
    hours: [{ days: EVERY_DAY, from: 0, to: h(24) }],
    access: "Second gate after the petrol pump. Open ground, park anywhere.",
  },
];

/** A point `km` away from the centre along `bearingDeg` (0 = north). */
function offset(km: number, bearingDeg: number) {
  const rad = (bearingDeg * Math.PI) / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((CENTRE.latitude * Math.PI) / 180);

  return {
    latitude: CENTRE.latitude + (km * Math.cos(rad)) / kmPerDegLat,
    longitude: CENTRE.longitude + (km * Math.sin(rad)) / kmPerDegLng,
  };
}

/**
 * Replaces the spot's photos with its one seeded cover, or with none.
 *
 * The file is written under a fixed name, so a re-run overwrites it rather
 * than leaving the previous run's copy behind to be served by nothing.
 */
async function seedPhoto(spot: SeedSpot): Promise<void> {
  const key = `spot-photos/${spot.id}`;
  const directory = path.resolve(STORAGE_DIR, key);

  await prisma.spotPhoto.deleteMany({ where: { listingId: spot.id } });
  await rm(directory, { recursive: true, force: true });

  if (!spot.photo) return;

  await mkdir(directory, { recursive: true });
  await copyFile(path.join(PHOTO_SOURCE, spot.photo), path.join(directory, "seed-cover.jpg"));

  await prisma.spotPhoto.create({
    data: {
      listingId: spot.id,
      url: `${STORAGE_BASE_URL}/${key}/seed-cover.jpg`,
      position: 0,
    },
  });
}

async function main() {
  // A seed that writes fake spots into a real marketplace is a disaster with
  // no undo, so the one guard worth having is the one that cannot be forgotten.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed dummy spots with NODE_ENV=production");
  }

  const host = await prisma.user.upsert({
    where: { email: HOST_EMAIL },
    update: {},
    create: { email: HOST_EMAIL, firstName: "Seed", lastName: "Host" },
  });

  // Both gates the search and checkout check, set directly: the seed host
  // never goes through onboarding or KYC.
  const profile = await prisma.hostProfile.upsert({
    where: { userId: host.id },
    update: { verificationStatus: "ACTIVE", payoutKycStatus: "ACTIVATED" },
    create: {
      userId: host.id,
      verificationStatus: "ACTIVE",
      payoutKycStatus: "ACTIVATED",
    },
  });

  const now = new Date();

  for (const spot of SPOTS) {
    const at = offset(spot.km, spot.bearingDeg);

    const listing = {
      hostProfileId: profile.id,
      listingType: "INDEPENDENT_SPOT",
      status: "PUBLISHED",
      name: spot.name,
      venueName: spot.name,
      spaceType: spot.spaceType,
      addressLine: spot.addressLine,
      city: "Unnao",
      state: "Uttar Pradesh",
      pincode: "209801",
      latitude: at.latitude,
      longitude: at.longitude,
      accessInstructions: spot.access,
      warrantyAcceptedAt: now,
      submittedAt: now,
      docApprovedAt: now,
      reviewedAt: now,
      createdBy: host.id,
      updatedBy: host.id,
    };

    await prisma.$transaction([
      prisma.listing.upsert({
        where: { id: spot.id },
        update: listing,
        create: { id: spot.id, ...listing },
      }),
      prisma.spotPricing.deleteMany({ where: { listingId: spot.id } }),
      prisma.spotPricing.createMany({
        data: Object.entries(spot.rates).map(([vehicleType, pricePerHour]) => ({
          listingId: spot.id,
          vehicleType,
          pricePerHour,
        })),
      }),
      prisma.hostAvailability.deleteMany({ where: { listingId: spot.id } }),
      prisma.hostAvailability.createMany({
        data: spot.hours.flatMap((window) =>
          window.days.map((dayOfWeek) => ({
            listingId: spot.id,
            dayOfWeek,
            startMinute: window.from,
            endMinute: window.to,
          }))
        ),
      }),
    ]);

    await seedPhoto(spot);

    const rates = Object.entries(spot.rates)
      .map(([type, price]) => `${type} ₹${price}/h`)
      .join(", ");
    console.log(`  ${spot.km.toFixed(1).padStart(4)} km  ${spot.name}  (${rates})`);
  }

  console.log(`\nSeeded ${SPOTS.length} spots around Bara Chauraha, Unnao.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
