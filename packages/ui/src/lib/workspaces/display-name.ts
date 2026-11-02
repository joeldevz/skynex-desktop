export function formatWorkspaceLabel(value: string): string {
  const [first, ...rest] = Array.from(value.toLocaleLowerCase());
  return first ? `${first.toLocaleUpperCase()}${rest.join('')}` : '';
}
