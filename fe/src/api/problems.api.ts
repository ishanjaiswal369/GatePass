import type { ProblemCategory } from "@/constants/enums";
import type { PresignedUpload, ProblemReport } from "@/types/api.types";
import { request } from "./client";

/**
 * "I can't use this parking." One report per booking: a second attempt is a
 * 409 whose body carries the first, which the screen then opens.
 */
export const report = (
  token: string,
  bookingId: string,
  input: { category: ProblemCategory; details?: string; photoUrl?: string }
) => request<ProblemReport>(`/bookings/${bookingId}/problem`, { method: "POST", body: input, token });

export const get = (token: string, bookingId: string) =>
  request<ProblemReport>(`/bookings/${bookingId}/problem`, { token });

/** A presigned PUT for the report's photo; the resulting fileUrl goes into `report`. */
export const photoUploadUrl = (token: string, bookingId: string, input: { contentType: string; contentLength: number }) =>
  request<PresignedUpload>(
    `/bookings/${bookingId}/problem/photo-upload-url`,
    { method: "POST", body: input, token }
  );
