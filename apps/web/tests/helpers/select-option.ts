import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Options are portalled, so query the document after opening the labelled trigger. */
export async function selectOption(trigger: HTMLElement, name: string, user: Pick<ReturnType<typeof userEvent.setup>, "click"> = userEvent) {
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name }));
}
