import { prisma } from "./prisma";
import crypto from "crypto";

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "business";
}

export async function generateUniqueBusinessSlug(name: string) {
  const base = slugify(name);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const slug = `${base}${suffix}`;
    const existing = await prisma.business.findUnique({ where: { slug } });

    if (!existing) {
      return slug;
    }
  }

  return `${base}-${cryptoRandomSuffix()}`;
}

function cryptoRandomSuffix() {
  return crypto.randomBytes(4).toString("hex");
}
