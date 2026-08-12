import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Member Login | Summit Trail Gear",
  description: "Log in to the Summit Trail Gear members area.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { error } = await props.searchParams;

  return (
    <article>
      <h1>Member login</h1>
      <p>
        This is a throwaway demo account for testing authenticated crawling. It is not a real
        customer login and holds no real data.
      </p>
      <p>
        Username: <code>crawler-test</code>
        <br />
        Password: <code>poc-demo-1234</code>
      </p>
      {error ? <p style={{ color: "#a4342b" }}>Invalid username or password.</p> : null}
      <form action="/api/session" method="POST">
        <p>
          <label>
            Username
            <br />
            <input type="text" name="username" defaultValue="crawler-test" />
          </label>
        </p>
        <p>
          <label>
            Password
            <br />
            <input type="password" name="password" defaultValue="poc-demo-1234" />
          </label>
        </p>
        <button type="submit">Log in</button>
      </form>
    </article>
  );
}
