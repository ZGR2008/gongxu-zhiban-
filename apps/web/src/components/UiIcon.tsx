type IconName = 'dashboard' | 'projects' | 'knowledge' | 'growth' | 'search' | 'spark' | 'agent' | 'code' | 'test' | 'document' | 'arrow' | 'grid' | 'list' | 'plus' | 'clock';
const paths: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  projects: 'M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 3h18',
  knowledge: 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4Zm8 2v15M7 8h2m-2 4h2m6-4h2m-2 4h2',
  growth: 'M4 3v17h17M8 15l4-5 4 2 5-7',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l5 5',
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  agent: 'M7 3h10v5H7zM7 16h10v5H7zM2 10h5v4H2zm15 0h5v4h-5zM12 8v8M7 12h10',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  test: 'M9 3h6m-5 0v7L4 20h16l-6-10V3M8 14h8',
  document: 'M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h8m-8 4h8',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  plus: 'M12 4v16M4 12h16',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
};
export function UiIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
export type { IconName };
