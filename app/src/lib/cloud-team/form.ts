import { z } from "zod";

export const cloudMaterialSchema = z.object({
  title: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(30_000),
});

export const cloudRunSchema = z.object({
  objective: z.string().trim().min(1).max(8_000),
  materialIds: z.array(z.string().min(1)).max(20),
});

export const cloudMemorySchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  sourceRunId: z.string().optional(),
});

/** Read locally for review first; selecting a file never uploads it. */
export async function readCloudMaterial(file: File) {
  if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.name.startsWith(".")) {
    throw new Error(
      "Choose a .txt, .md, .csv or .json file, not a hidden file.",
    );
  }
  if (file.size > 120_000) {
    throw new Error("This file is too large. Split it into smaller materials.");
  }
  const content = await file.text();
  if (content.includes("\0")) {
    throw new Error("This file contains binary data. Export it as plain text.");
  }
  const parsed = cloudMaterialSchema.safeParse({
    title: file.name,
    source: file.name,
    content,
  });
  if (!parsed.success) {
    throw new Error(
      "Use a nonempty text file with at most 30,000 characters and a short filename.",
    );
  }
  return parsed.data;
}
