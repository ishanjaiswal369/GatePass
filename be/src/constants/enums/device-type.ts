export const DEVICE_TYPES = ["IOS", "ANDROID", "WEB", "OTHER"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEFAULT_DEVICE_TYPE: DeviceType = "OTHER";
