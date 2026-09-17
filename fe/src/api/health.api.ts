import type { HealthResult } from "@/types/api.types";
import { request } from "./client";

export const healthCheck = () => request<HealthResult>("/health");
