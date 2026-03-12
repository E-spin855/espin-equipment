import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const { public_id } = req.body ?? {};
  if (!public_id) {
    res.status(400).json({ error: "MISSING_PUBLIC_ID" });
    return;
  }

  const result = await cloudinary.uploader.destroy(public_id);
  res.status(200).json(result);
}
