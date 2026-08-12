import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trail Nutrition That Actually Works | Summit Trail Gear",
  description:
    "Calories per gram, salt, and timing: a simple approach to eating on day hikes and multi-day trips.",
};

export default function TrailNutritionPage() {
  return (
    <article>
      <h1>Trail nutrition that actually works</h1>
      <p>
        Long days on trail are an eating problem disguised as a walking problem. Most hikers who
        &quot;hit the wall&quot; at kilometer twenty did not run out of fitness — they ran out of
        fuel two hours earlier and only felt it late.
      </p>
      {/* seeded: broken heading hierarchy — H1 jumps to H3, no H2 on the page (manifest #6c) */}
      <h3>Eat early, eat small</h3>
      <p>
        Start snacking within the first hour and keep portions small: a handful every 45 minutes
        beats a big lunch. Digestion competes with your legs for blood flow, which is why the
        classic giant summit sandwich is followed by the classic sleepy descent.
      </p>
      <h3>Density wins on multi-day trips</h3>
      <p>
        For overnights, judge food in calories per gram and aim above 4. Nuts, olive oil, hard
        cheese, and chocolate carry well; fresh fruit is morale, not fuel. Repackage everything —
        boxes weigh, bags do not.
      </p>
      <h3>Salt is not optional</h3>
      <p>
        Sweat costs you sodium as well as water, and plain water alone on a hot day can leave you
        nauseous and cramping. Salty snacks or electrolyte tablets every couple of hours keep the
        system balanced. Thirst lags need — drink on schedule, not on craving.
      </p>
    </article>
  );
}
