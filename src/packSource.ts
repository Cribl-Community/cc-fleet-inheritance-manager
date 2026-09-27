export function isReusablePackSource(source: string): boolean {
  const trimmed = source.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('file:') || trimmed.startsWith('data:')) {
    return false;
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return false;
  }

  if (/\.(crbl|zip)$/i.test(trimmed)) {
    return true;
  }

  return /^staged:/i.test(trimmed)
    || /^git@/i.test(trimmed)
    || /^git\+https?:\/\//i.test(trimmed)
    || /^https?:\/\//i.test(trimmed);
}
