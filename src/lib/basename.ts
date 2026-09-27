/** Last path segment, for both / and \ separators (works in the browser too). */
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? "";
}
