"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/patterns";
import type { CandidateFormValues } from "../form";

/**
 * Personal details (also reused in profile edit). Reads the shared RHF context. Onboarding hides
 * the target-role field because it has its own Target step.
 */
export function PersonalFields({ showTargetRole = true }: { showTargetRole?: boolean }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<CandidateFormValues>();

  // Wide: name · email · phone / location · headline. Two columns: name and headline full width.
  return (
    <div className="iq-fields">
      <div className="iq-grid gap-4" data-cols="3">
        <FormField
          label="Full name"
          htmlFor="fullName"
          error={errors.fullName?.message}
          className="iq-span-2-narrow"
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

        {showTargetRole ? (
          <FormField label="Target role" htmlFor="targetRole" hint="The role you're preparing for" className="iq-span-2-wide">
            <Input id="targetRole" placeholder="Backend Engineer" {...register("targetRole")} />
          </FormField>
        ) : null}

        <FormField
          label="Headline"
          htmlFor="headline"
          hint="A one-line summary"
          className={showTargetRole ? "iq-span-all" : "iq-span-2"}
        >
          <Input
            id="headline"
            placeholder="Final-year CSE student · aspiring backend engineer"
            {...register("headline")}
          />
        </FormField>
      </div>
    </div>
  );
}
