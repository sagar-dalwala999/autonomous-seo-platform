/* seeded: no metadata export — page has no <title> and no meta description (manifest #1, #4) */
export default function AboutPage() {
  return (
    <article>
      <h1>About Summit Trail Gear</h1>
      <p>
        Summit Trail Gear is a small outdoor-equipment company run by people who spend their
        weekends above the treeline. We began in 2019 as a gear-review newsletter and moved into
        making our own equipment when we could not find a 45-liter pack that balanced weight,
        durability, and price the way we wanted.
      </p>
      <p>
        Every product we sell is carried on real trips before it ships. Our testing loop is simple:
        prototype, hike, break it, fix it, hike again. Anything that survives two full seasons of
        Pacific Northwest weather earns a listing in the shop.
      </p>
      <h2>What we believe</h2>
      <p>
        Good gear is quiet. It does not need replacing every season, it does not need a manual, and
        it should disappear on your back so the trail can take up all of your attention. We would
        rather sell you one pack that lasts a decade than three that last a year each.
      </p>
      <p>
        {/* seeded: http:// (non-https) absolute internal link (manifest #15b) */}
        Questions about an order or a product? Reach the team through the{" "}
        <a href="http://summittrailgear.example/contact">contact page</a> and a human will reply
        within two business days.
      </p>
    </article>
  );
}
