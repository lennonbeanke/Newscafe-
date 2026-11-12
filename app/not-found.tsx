import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <section className="theme-dark flex min-h-svh flex-col items-center justify-center gap-8 bg-ink px-6 text-center">
      <p className="eyebrow">Error 404</p>
      <h1 className="display text-gold-gradient text-7xl md:text-9xl">Lost in the night</h1>
      <p className="max-w-md text-mist">The page you&apos;re looking for has slipped out the back door.</p>
      <Button href="/">Back to the lounge</Button>
    </section>
  );
}
