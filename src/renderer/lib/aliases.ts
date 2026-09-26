// Shorthand people actually type. Carried over from the web version.
const ALIASES: Record<string, string> = {
  jjk: 'Jujutsu Kaisen',
  aot: 'Attack on Titan',
  snk: 'Shingeki no Kyojin',
  mha: 'My Hero Academia',
  bnha: 'Boku no Hero Academia',
  db: 'Dragon Ball',
  dbz: 'Dragon Ball Z',
  dbs: 'Dragon Ball Super',
  ds: 'Demon Slayer',
  kny: 'Kimetsu no Yaiba',
  op: 'One Piece',
  csm: 'Chainsaw Man',
  fma: 'Fullmetal Alchemist',
  fmab: 'Fullmetal Alchemist: Brotherhood',
  sao: 'Sword Art Online',
  nge: 'Neon Genesis Evangelion',
  eva: 'Neon Genesis Evangelion',
  opm: 'One Punch Man',
  hxh: 'Hunter x Hunter',
  sl: 'Solo Leveling',
  tg: 'Tokyo Ghoul',
  bc: 'Black Clover',
  dn: 'Death Note',
  cg: 'Code Geass',
  vinland: 'Vinland Saga',
  slime: 'That Time I Got Reincarnated as a Slime',
  mob: 'Mob Psycho 100',
  mp100: 'Mob Psycho 100',
  sxf: 'Spy x Family',
  kaiju: 'Kaiju No. 8',
  frieren: "Frieren: Beyond Journey's End",
  dandadan: 'Dandadan',
  oshi: 'Oshi no Ko',
  bocchi: 'Bocchi the Rock!',
  re0: 'Re:Zero',
  rezero: 'Re:Zero',
  konosuba: 'KonoSuba',
  toradora: 'Toradora!',
};

export function expandAlias(query: string): { query: string; expanded: boolean } {
  const key = query.trim().toLowerCase();
  const hit = ALIASES[key];
  return hit ? { query: hit, expanded: true } : { query: query.trim(), expanded: false };
}
