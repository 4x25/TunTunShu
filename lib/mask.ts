export function maskKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= 8) {
    return `${value.slice(0, 1)}...${value.slice(-1)}`;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
