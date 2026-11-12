"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { FiCheck } from "react-icons/fi";
import { site } from "@/lib/site";
import { Field } from "./Field";

const enquiryTypes = ["- Please Select -", "Complaint", "Compliment", "Suggestion"];

/**
 * Marketing-site enquiry form. There is no backend: submitting composes a pre-filled email to the address in
 * lib/site.ts so the visitor sends it from their own mail app.
 */
export function ReservationForm() {
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const body = [
      `Name: ${d.get("name")} ${d.get("surname")}`,
      `Contact number: ${d.get("phone") || "—"}`,
      `Email: ${d.get("email")}`,
      `Enquiry type: ${d.get("type")}`,
      "",
      `${d.get("message") || ""}`,
    ].join("\n");
    const subject = `Website enquiry — ${d.get("type")} — ${d.get("name")} ${d.get("surname")}`;
    window.location.href = `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <div id="enquire" className="glass relative scroll-mt-32 overflow-hidden rounded-3xl p-8 md:p-12">
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex min-h-[28rem] flex-col items-center justify-center gap-6 text-center"
          >
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-gold text-ink"
            >
              <FiCheck size={36} />
            </motion.span>
            <h3 className="display text-5xl">Almost there</h3>
            <p className="max-w-sm text-bone/70">
              Your email app should have opened with your details filled in. Hit send and we&apos;ll confirm within a few hours.
            </p>
            <button onClick={() => setSent(false)} className="eyebrow border-b border-gold/50 pb-1">Edit request</button>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={onSubmit} exit={{ opacity: 0, y: -20 }} className="flex flex-col gap-4">
            <p className="eyebrow">Get in touch</p>
            <h2 className="display mb-4 text-4xl md:text-5xl">General enquiry</h2>
            <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
              <Field label="Name" name="name" required autoComplete="given-name" />
              <Field label="Surname" name="surname" required autoComplete="family-name" />
              <Field label="Contact Number" name="phone" type="tel" autoComplete="tel" />
              <Field label="Email Address" name="email" type="email" required autoComplete="email" />
            </div>
            <Field label="Enquiry type" name="type" as="select" options={enquiryTypes} />
            <Field label="Message" name="message" as="textarea" required />
            <button
              type="submit"
              className="group relative mt-6 self-start overflow-hidden rounded-full bg-gold px-10 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-ink"
            >
              <span aria-hidden className="absolute inset-0 translate-y-full bg-bone transition-transform duration-500 ease-lux group-hover:translate-y-0" />
              <span className="relative">Send</span>
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
