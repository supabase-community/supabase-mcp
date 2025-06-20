/**
 * Parses a delimited list of items into an array,
 * trimming whitespace and filtering out empty items.
 *
 * Default delimiter is a comma (`,`).
 */
export function parseList(list: string, delimiter = ','): string[] {
  const items = list.split(delimiter).map((feature) => feature.trim());
  return items.filter((feature) => feature !== '');
}
