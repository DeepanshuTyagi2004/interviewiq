import { ProcessEditor } from "../_components/ProcessEditor";

export default async function ProcessEditorPage({ params }: { params: Promise<{ processId: string }> }) {
  const { processId } = await params;
  return <ProcessEditor processId={processId} />;
}
