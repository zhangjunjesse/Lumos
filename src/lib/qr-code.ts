"use client";

export async function generateQrCodeDataUrl(value: string, size = 240): Promise<string> {
  if (!value.trim()) return "";

  const QRCode = await import("qrcode");
  return QRCode.toDataURL(value, {
    width: size,
    margin: 1,
  });
}
