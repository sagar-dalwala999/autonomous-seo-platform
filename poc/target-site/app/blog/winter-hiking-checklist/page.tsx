import type { Metadata } from "next";

/* seeded: near-duplicate content pair with /blog/winter-day-hike-checklist, ~90% identical (manifest #18) */
export const metadata: Metadata = {
  title: "Winter Hiking Checklist | Summit Trail Gear",
  description:
    "The winter checklist we run before every cold-season hike: clothing, traction, light, food, and a turnaround time.",
};

export default function WinterHikingChecklistPage() {
  return (
    <article>
      <h1>Winter hiking checklist</h1>
      <p>
        Winter turns small mistakes into big ones. Daylight is short, wet is dangerous, and a
        twisted ankle that means a boring wait in July can mean hypothermia in January. We run this
        checklist before every cold-season hike, without exception, even on trails we know well.
      </p>
      <h2>Clothing</h2>
      <p>
        No cotton anywhere. A wicking base layer, an insulating mid layer, and a waterproof shell,
        plus a spare insulation piece that stays dry in the pack until you stop moving. Warm hat,
        liner gloves inside insulated gloves, and wool socks with a dry spare pair.
      </p>
      <h2>Traction and light</h2>
      <p>
        Microspikes go in the pack from November to April whether the trailhead is icy or not.
        Carry a headlamp with fresh batteries and keep a spare set warm in an inside pocket — cold
        drains batteries far faster than summer hikers expect.
      </p>
      <h2>Food, water, and the turnaround</h2>
      <p>
        Cold suppresses thirst, so drink on a schedule, and pack more calories than a summer day
        needs. Set a hard turnaround time before you leave the car and honor it. The summit is
        optional; the parking lot is mandatory.
      </p>
    </article>
  );
}
