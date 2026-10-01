/** Eyebrow, large light title and supporting line at the top of every auth screen. */
export function AuthHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <p className="iq-eyebrow m-0">{eyebrow}</p>
      <h1 className="m-0 text-[34px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[40px]">{title}</h1>
      <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">{description}</p>
    </div>
  );
}
