/** Réduit une photo (1600 px max, JPEG) avant l'envoi : économise la bande passante des utilisateurs. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  if (file.size > 15 * 1024 * 1024) throw new Error('Image trop lourde (15 Mo maximum).');
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Compression impossible sur ce navigateur.');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Compression impossible.'))), 'image/jpeg', quality));
}
