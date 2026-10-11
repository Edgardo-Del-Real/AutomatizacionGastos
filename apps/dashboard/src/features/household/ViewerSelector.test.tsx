import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HouseholdMember } from "@rita/contracts";

import { fetchHouseholdMembers } from "../../infra/api";
import { ViewerProvider } from "./ViewerContext";
import { ViewerSelector } from "./ViewerSelector";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchHouseholdMembers: vi.fn(),
}));

const fetchHouseholdMembersMock = vi.mocked(fetchHouseholdMembers);

const duo: HouseholdMember[] = [
  { ownerId: "rita", name: "Rita" },
  { ownerId: "edgardo", name: "Edgardo" },
];

beforeEach(() => {
  window.localStorage.removeItem("rita.viewer");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ViewerSelector", () => {
  it("renders nothing when the household has a single member", async () => {
    fetchHouseholdMembersMock.mockResolvedValue([
      { ownerId: "default", name: "Rita" },
    ]);

    render(
      <ViewerProvider>
        <ViewerSelector />
      </ViewerProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("Ver como")).toBeNull();
    });
  });

  it("lists every household member by name in a labeled select", async () => {
    fetchHouseholdMembersMock.mockResolvedValue(duo);

    render(
      <ViewerProvider>
        <ViewerSelector />
      </ViewerProvider>,
    );

    const select = await screen.findByLabelText("Ver como");
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Rita", "Edgardo"]);
    // a11y: the visible label is wired to the control via htmlFor/id.
    expect(select).toHaveAccessibleName("Ver como");
  });

  it("switching the viewer persists the selection and updates the control", async () => {
    fetchHouseholdMembersMock.mockResolvedValue(duo);
    const user = userEvent.setup();

    render(
      <ViewerProvider>
        <ViewerSelector />
      </ViewerProvider>,
    );

    const select = await screen.findByLabelText("Ver como");
    expect(select).toHaveValue("rita");

    await user.selectOptions(select, "edgardo");

    expect(select).toHaveValue("edgardo");
    expect(window.localStorage.getItem("rita.viewer")).toBe("edgardo");
  });
});