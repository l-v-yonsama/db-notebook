export const abbr = (s: string | undefined, len = 10): string | undefined => {
  if (!s) {
    return s;
  }
  if (s.length > len) {
    const half = s.length / 2 - 1;
    return s.substring(0, half) + ".." + s.substring(s.length - half);
  } else {
    return s;
  }
};
