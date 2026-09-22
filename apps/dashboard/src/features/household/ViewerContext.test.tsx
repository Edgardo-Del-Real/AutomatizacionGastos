import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HouseholdMember } from "@rita/contracts";

import { ApiError, fetchHouseholdMembers } from "../../infra/api";
import { ViewerProvider, useViewer } from "./ViewerContext";

vi.mock("../../infra/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/api")>()),
  fetchHouseholdMembers: vi.fn(),
}));

const fetchHouseholdMembersMock = vi.mocked(fetchHouseholdMembers);

const duo: HouseholdMember[] = [
  { ownerId: "rita", name: "Rita" },
  { ownerId: "edgardo", name: "Edgardo" },
];

function Probe() {
  const viewer = useViewer();
  return (
    <div>
      <output data-testid="viewer-id">{viewer.viewerId}</output>
      <output data-testid="selector-visible">
        {String(viewer.selectorVisible)}
      </output>
      <output data-testid="member-count">{viewer.members.length}</output>
      <button type="button" onClick={() => viewer.setViewerId("rita")}>
        elegir-rita
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.removeItem("rita.viewer");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ViewerContext", () => {
  it("exposes the household members and shows the selector for a duo", async () => {
    fetchHouseholdMembersMock.mockResolvedValue(duo);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("member-count")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("selector-visible")).toHaveTextContent("true");
  });

  it("resolves the persisted viewer against the member list", async () => {
    window.localStorage.setItem("rita.viewer", "edgardo");
    fetchHouseholdMembersMock.mockResolvedValue(duo);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("edgardo"),
    );
  });

  it("falls back to VITE_OWNER_ID when the stored viewer is unknown and it is a member", async () => {
    window.localStorage.setItem("rita.viewer", "ghost");
    fetchHouseholdMembersMock.mockResolvedValue([
      { ownerId: "default", name: "Rita" },
      { ownerId: "edgardo", name: "Edgardo" },
    ]);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("default"),
    );
  });

  it("falls back to the first member when the stored viewer is unknown and VITE_OWNER_ID is not a member", async () => {
    window.localStorage.setItem("rita.viewer", "ghost");
    fetchHouseholdMembersMock.mockResolvedValue(duo);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("rita"),
    );
  });

  it("hides the selector and uses VITE_OWNER_ID for a single-member household", async () => {
    fetchHouseholdMembersMock.mockResolvedValue([
      { ownerId: "default", name: "Rita" },
    ]);

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("default"),
    );
    expect(screen.getByTestId("selector-visible")).toHaveTextContent("false");
  });

  it("falls back to VITE_OWNER_ID with no selector when the household request fails", async () => {
    fetchHouseholdMembersMock.mockRejectedValue(new ApiError("network"));

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("default"),
    );
    expect(screen.getByTestId("selector-visible")).toHaveTextContent("false");
  });

  it("setViewerId updates the viewer and persists it to localStorage", async () => {
    window.localStorage.setItem("rita.viewer", "edgardo");
    fetchHouseholdMembersMock.mockResolvedValue(duo);
    const user = userEvent.setup();

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("viewer-id")).toHaveTextContent("edgardo"),
    );

    await user.click(screen.getByRole("button", { name: "elegir-rita" }));

    expect(screen.getByTestId("viewer-id")).toHaveTextContent("rita");
    expect(window.localStorage.getItem("rita.viewer")).toBe("rita");
  });
});