"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/patterns";
import type { CandidateFormValues } from "../form";

/** Step 1 fields (also reused in profile edit). Reads the shared RHF context. */
export function PersonalFields() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CandidateFormValues>();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        label="Full name"
        htmlFor="fullName"
        error={errors.fullName?.message}
        className="sm:col-span-2"
      >
        <Input id="fullName" placeholder="Asha Rao" {...register("fullName")} />
      </FormField>

      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" placeholder="asha@example.com" {...register("email")} />
      </FormField>

      <FormField label="Phone" htmlFor="phone">
        <Input id="phone" placeholder="+91 90000 00000" {...register("phone")} />
      </FormField>

      <FormField label="Location" htmlFor="location">
        <Input id="location" placeholder="Bengaluru, India" {...register("location")} />
      </FormField>

      <FormField label="Target role" htmlFor="targetRole" hint="The role you're preparing for">
        <Input id="targetRole" placeholder="Backend Engineer" {...register("targetRole")} />
      </FormField>

      <FormField
        label="Headline"
        htmlFor="headline"
        hint="A one-line summary"
        className="sm:col-span-2"
      >
        <Input
          id="headline"
          placeholder="Final-year CSE student · aspiring backend engineer"
          {...register("headline")}
        />
      </FormField>
    </div>
  );
}
