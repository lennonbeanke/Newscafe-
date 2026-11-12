import { ScrubText } from "@/components/ui/ScrubText";

export function Manifesto() {
  return (
    <section className="py-32 md:py-56">
      <div className="container-x">
        <p className="eyebrow mb-10">Who we are</p>
        <ScrubText
          className="max-w-6xl text-[clamp(2.2rem,5.6vw,5.6rem)] leading-[1.06]"
          text="At News Cafe it's all about the *vibe.* Good food, great cocktails and an atmosphere you can't miss, from breakfast to the last round."
        />
      </div>
    </section>
  );
}
