import { Suspense } from "react";
import { LoopsHub } from "./_components/LoopsHub";

export default function LoopsPage() {
  return (
    <Suspense>
      <LoopsHub />
    </Suspense>
  );
}
