export function ArenaIntro({ draft = false }: { draft?: boolean }) {
  return (
    <section className="arena-intro" aria-label={draft ? "Draft room" : "Basketball workspace"}>
      <div>
        <p className="eyebrow">Fantasy basketball / {draft ? "Draft room" : "Courtside intelligence"}</p>
        <h2>{draft ? "Build your starting five." : "Your court. Your advantage."}</h2>
        <p>{draft ? "Scout the talent. Make your pick. Build a contender." : "Read the matchup. Find your next pickup. Own the game."}</p>
      </div>
      <div className="arena-emblem" aria-hidden="true" />
    </section>
  );
}
