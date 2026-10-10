/** The sheet the printer is given, and how the envelope sits on it. */
export type PaperKind = 'envelope' | 'letter' | 'a4';
export type PaperPosition = 'left' | 'center' | 'right';
/** Counterclockwise turn of the whole envelope, in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export const PAPER_KINDS: readonly PaperKind[] = ['envelope', 'letter', 'a4'];
export const PAPER_POSITIONS: readonly PaperPosition[] = ['left', 'center', 'right'];
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Portrait sheet sizes in points. */
export const PAPER_SIZES_PT: Record<Exclude<PaperKind, 'envelope'>, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};
