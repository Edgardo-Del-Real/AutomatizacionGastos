import { describe, expect, it } from "vitest";
import {
  alreadyProcessedReply,
  ayudaReply,
  balanceQueryReply,
  capturePromptReply,
  captureShapedRedirectReply,
  categoriesQueryReply,
  categoryAdminReply,
  categoryCrudRedirectReply,
  categoryCreatedReply,
  categoryDeleteConfirmReply,
  categoryDeletePickReply,
  categoryDeletedReply,
  categoryGoneReply,
  categoryListReply,
  categoryNamePromptReply,
  categoryRenamedReply,
  categoryRenamePickReply,
  compartidoPrefixRedirectReply,
  correctionEmptyReply,
  correctionPickListReply,
  deletedMovementReply,
  deleteAskReply,
  deleteCancelledReply,
  deleteConfirmReply,
  deletePickListReply,
  duplicateCategoryReply,
  expenseAdminReply,
  formatARS,
  greetingReply,
  markPaidAlreadyReply,
  markPaidAskReply,
  markPaidReply,
  menuReply,
  missingCategoryReply,
  monthQueryReply,
  movementCorrectionDoneReply,
  movementMissingReply,
  movementNoMatchReply,
  nothingPendingReply,
  nothingToDeleteReply,
  otroDeleteForbiddenReply,
  plannedQueryReply,
  plannedReply,
  previewAskCategoryReply,
  previewConfirmReply,
  previewReply,
  previstoPrefixRedirectReply,
  queryRedirectReply,
  queryReplyTemplate,
  reassignCategoryReply,
  recentQueryReply,
  reportsMenuReply,
  reservedCategoryReply,
  savingsForbiddenReply,
  savingsOverrideRedirectReply,
  savingsQueryReply,
  savingsRuleDefinedReply,
  savingsRuleInvalidReply,
  selectionAbandonedReply,
  setupBatchDoneReply,
  setupDoneReply,
  setupDoneWithRedirectsReply,
  setupQuestionReply,
  setupRetryReply,
  successReply,
  successSplitReply,
  truncateNote,
  unresolvableReply,
} from "./reply-text";

describe("formatARS", () => {
  it("formats ARS amounts with the es-AR locale", () => {
    expect(formatARS(2500)).toBe("$\u00A02.500,00");
  });

  it("formats decimal amounts", () => {
    expect(formatARS(1500.5)).toBe("$\u00A01.500,50");
  });
});

describe("truncateNote", () => {
  it("keeps a short note unchanged", () => {
    expect(truncateNote("cafe")).toBe("cafe");
  });

  it("truncates a note longer than 500 chars with an ellipsis", () => {
    const long = "a".repeat(520);
    const result = truncateNote(long);

    expect(result).toHaveLength(500);
    expect(result.endsWith("…")).toBe(true);
    expect(result.slice(0, 499)).toBe("a".repeat(499));
  });
});

describe("reply builders", () => {
  it("builds a success confirmation with amount, note and category", () => {
    expect(successReply(2500, "cafe", "Cafe")).toBe(
      "✅ Guardado: $\u00A02.500,00 (cafe) — Categoría: Cafe",
    );
  });

  it("builds a success confirmation without a note", () => {
    expect(successReply(8000, null, "otro")).toBe(
      "✅ Guardado: $\u00A08.000,00 — Categoría: otro",
    );
  });

  it("truncates long notes inside the success reply", () => {
    const long = "x".repeat(600);
    const result = successReply(100, long, "Cafe");
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(600);
  });

  it("builds the split confirmation reporting gross, net and savings", () => {
    expect(successSplitReply(1000, 900, 100)).toBe(
      "✅ Guardado: ingreso neto $\u00A0900,00 de $\u00A01.000,00 — Ahorrado: $\u00A0100,00 (categoría ahorro)",
    );
  });

  it("builds the planned registration confirmation without claiming the balance", () => {
    const text = plannedReply(2500, "alquiler", "Vivienda");

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("previsto");
    expect(text).toContain("alquiler");
    expect(text).toContain("Categoría: Vivienda");
    expect(text).toContain("✅");
  });

  it("redirects legacy text category CRUD to the 🗂 button flow", () => {
    const text = categoryCrudRedirectReply();

    expect(text).toContain("Administrar categorías");
    expect(text).toContain("🗂");
  });

  it("builds the setup question", () => {
    expect(setupQuestionReply([])).toContain("categorías");
  });

  it("builds the setup retry question", () => {
    expect(setupRetryReply()).toContain("categoría");
  });

  it("builds the setup-done confirmation listing the created categories", () => {
    expect(setupDoneReply(["Cafe", "Transporte", "otro"])).toBe(
      'Categorías creadas: Cafe, Transporte, otro.',
    );
  });

  it("builds the setup-done reply with reserved redirects", () => {
    const text = setupDoneWithRedirectsReply(
      ["Cafe", "otro"],
      [{ name: "gastos fijos", concept: "gasto fijo" }],
    );

    expect(text).toContain("Cafe");
    expect(text).toContain("otro");
    expect(text).toContain("gastos fijos");
    expect(text).toContain("previsto");
  });

  it("builds the batch-done summary with created, deleted and renamed entries", () => {
    const text = setupBatchDoneReply({
      created: ["Salud", "otro"],
      redirects: [],
      deleted: ["no"],
      renamed: [{ from: "Cafe", to: "Cafeteria" }],
    });

    expect(text).toContain("Categorías creadas: Salud, otro.");
    expect(text).toContain("Borradas: no.");
    expect(text).toContain('"Cafe" a "Cafeteria"');
  });

  it.each([
    ["previsto", "previsto: <monto> <nota>"],
    ["gasto fijo", "previsto: <monto> <nota>"],
    ["ahorro", "registrar ahorro:"],
    ["compartido", "compartido:"],
    ["compartida", "compartido:"],
    ["otro", "respaldo"],
  ] as const)("builds the reserved redirect for the %s concept teaching the system usage", (concept, teaches) => {
    const text = reservedCategoryReply("gastos fijos", concept);

    expect(text).toContain("gastos fijos");
    expect(text).toContain(teaches);
  });

  it("builds command confirmations", () => {
    expect(categoryCreatedReply("Salud")).toBe('Categoría "Salud" creada.');
    expect(categoryRenamedReply("Cafe", "Cafeteria")).toBe(
      'Categoría renombrada: "Cafe" → "Cafeteria".',
    );
  });

  it("builds the delete confirmation and the otro/savings guards", () => {
    expect(categoryDeletedReply("Viajes")).toBe('Categoría "Viajes" borrada.');
    expect(otroDeleteForbiddenReply()).toContain("otro");
    expect(savingsForbiddenReply()).toContain("ahorro");
  });

  it("builds command error replies", () => {
    expect(duplicateCategoryReply("Salud")).toContain("Salud");
    expect(missingCategoryReply("Salud")).toContain("Salud");
    expect(movementMissingReply()).toContain("no existe");
  });

  it("builds a category list with keywords", () => {
    const list = categoryListReply([
      { name: "Cafe", keywords: ["cafe"] },
    ]);
    expect(list).toContain("Cafe");
    expect(list).toContain("cafe");
  });

  it("builds the savings-rule defined and invalid replies", () => {
    expect(savingsRuleDefinedReply("entrenuts", 10)).toContain("entrenuts");
    expect(savingsRuleDefinedReply("entrenuts", 10)).toContain("10%");
    expect(savingsRuleInvalidReply()).toContain("0");
  });
});

describe("query reply templates", () => {
  it("lists the owner categories", () => {
    expect(categoriesQueryReply([])).toContain("No tenés categorías");
  });

  it("renders the recent movements with kind, category and note", () => {
    const text = recentQueryReply([
      { amount: 2500, category: "Cafe", note: "capuchino", date: "2026-09-19", type: "EXPENSE" },
    ]);
    expect(text).toContain("19/09");
    expect(text).toContain("gasto");
    expect(text).toContain("Cafe");
  });

  it("renders the balance with income minus expenses", () => {
    const text = balanceQueryReply(600, 900, 300);
    expect(text).toContain("600");
    expect(text).toContain("900");
    expect(text).toContain("300");
  });

  it("renders the month summary", () => {
    const text = monthQueryReply("2026-09", 900, 300, 2);
    expect(text).toContain("septiembre");
    expect(text).toContain("900");
    expect(text).toContain("300");
  });

  it("renders the savings summary", () => {
    expect(savingsQueryReply(100, "2026-09")).toContain("100");
  });

  it("renders the planned total", () => {
    expect(plannedQueryReply("2026-10", 2500)).toContain(formatARS(2500));
  });

  it("dispatches the template by the executed query type", () => {
    const recent = queryReplyTemplate({ query_type: "recent", movements: [] });
    expect(recent).toContain("Todavía no tenés movimientos");
  });
});

describe("v2 redirect and flow templates (bot-free-text-routing / quick-capture)", () => {
  it("asks for a category when Guardar is tapped without a selection", () => {
    const text = previewAskCategoryReply();

    expect(text).toContain("categoría");
    expect(text).toContain("Guardar");
  });

  it("redirects capture-shaped text to the ➕ Nuevo gasto button", () => {
    const text = captureShapedRedirectReply();

    expect(text).toContain("➕ Nuevo gasto");
    expect(text).toContain("mandalo");
  });

  it("redirects the previsto: prefix to the 📅 Gasto previsto button", () => {
    const text = previstoPrefixRedirectReply();

    expect(text).toContain("📅 Gasto previsto");
    expect(text).toContain("previsto");
  });

  it("redirects the compartido: prefix to the 👥 Compartido button", () => {
    const text = compartidoPrefixRedirectReply();

    expect(text).toContain("👥 Compartido");
  });

  it("redirects savings-override text to the automatic rule", () => {
    const text = savingsOverrideRedirectReply();

    expect(text).toContain("ahorro");
    expect(text).toContain("automáticamente");
  });

  it("replies the unresolvable fallback", () => {
    const text = unresolvableReply();

    expect(text.toLowerCase()).toContain("no puedo resolver eso");
  });

  it("prompts for a category name in the preview flow", () => {
    const text = categoryNamePromptReply("preview");

    expect(text).toContain("categoría");
  });

  it("prompts for a category name in the admin create flow", () => {
    const text = categoryNamePromptReply("admin_create");

    expect(text).toContain("crear");
  });

  it("prompts for a category name in the admin rename flow", () => {
    const text = categoryNamePromptReply("admin_rename");

    expect(text).toContain("nombre");
  });

  it("asks for the category-delete confirmation naming the category", () => {
    const text = categoryDeleteConfirmReply("Viajes");

    expect(text).toContain("Viajes");
    expect(text).toContain("Borrar");
  });

  it("reports the pick abandonment without claiming changes", () => {
    const text = selectionAbandonedReply();

    expect(text).toContain("abandoné");
    expect(text).toContain("no cambié nada");
  });

  it("builds the query failure redirect", () => {
    expect(queryRedirectReply()).toContain("No pude consultar");
  });

  it("builds the sub-menu entry texts", () => {
    expect(expenseAdminReply()).toContain("Administrar gastos");
    expect(categoryAdminReply()).toContain("Administrar categorías");
    expect(reportsMenuReply()).toContain("Reportes");
  });

  it("builds the correction pick-list ask with the numbered candidates", () => {
    const text = correctionPickListReply([{ amount: 2500, note: "alquiler", date: "2026-09-19" }]);

    expect(text).toContain("¿Qué movimiento querés corregir?");
    expect(text).toContain("1) 19/09 · $\u00A02.500,00 · alquiler");
  });

  it("builds the correction empty-window reply", () => {
    expect(correctionEmptyReply()).toContain("No hay gastos para corregir");
  });

  it("builds the category admin pick asks", () => {
    expect(categoryRenamePickReply()).toContain("renombrar");
    expect(categoryDeletePickReply()).toContain("borrar");
  });

  it("builds the reassign ask", () => {
    expect(reassignCategoryReply()).toContain("categoría nueva");
  });

  it("builds the category-gone reply for a stale admin pick", () => {
    expect(categoryGoneReply()).toContain("ya no existe");
  });
});

describe("main menu and help templates", () => {
  it("builds the menu text inviting the owner to choose", () => {
    const text = menuReply();

    expect(text).toContain("menú");
    expect(text.length).toBeGreaterThan(0);
  });

  it("builds the static help explaining the eight buttons with examples and never teaching prefixes (spec: Static Help)", () => {
    const text = ayudaReply();

    expect(text).toContain("Nuevo gasto");
    expect(text).toContain("30000 gym");
    expect(text).toContain("Administrar categorías");
    expect(text).toContain("no se cargan");
    expect(text).toContain("listar categorias");
    expect(text).not.toContain("previsto:");
    expect(text).not.toContain("compartido:");
  });

  it("greets warmly and expense-scoped, pointing to the menu", () => {
    const text = greetingReply();

    expect(text).toContain("¡Hola!");
    expect(text).toContain("gastos");
    expect(text).toContain("menú");
  });

  it("builds the already-processed reply for a retried callback", () => {
    expect(alreadyProcessedReply()).toContain("ya fue procesada");
  });
});

describe("bot expense lifecycle reply templates", () => {
  it("confirms a marked-paid transition with amount, note and category", () => {
    expect(markPaidReply(2500, "alquiler", "Vivienda")).toBe(
      'Listo, marqué como pagado: $\u00A02.500,00 (alquiler) — Categoría: Vivienda.',
    );
  });

  it("builds the already-paid conflict notice", () => {
    expect(markPaidAlreadyReply()).toBe("Ese movimiento ya estaba pagado: no cambié nada.");
  });

  it("builds the nothing-pending reply", () => {
    expect(nothingPendingReply()).toContain("previsto");
  });

  it("builds the nothing-to-delete reply stating nothing was deleted", () => {
    expect(nothingToDeleteReply()).toContain("No borré nada");
  });

  it("confirms a deleted expense with amount, note and category", () => {
    expect(deletedMovementReply(2500, "cafe", "Cafe")).toBe(
      'Borré el gasto: $\u00A02.500,00 (cafe) — Categoría: Cafe.',
    );
  });

  it("asks which planned expense was paid with numbered candidates", () => {
    const text = markPaidAskReply([
      { amount: 2500, note: "alquiler", date: "2026-09-19" },
    ]);
    expect(text).toContain("¿Cuál de estos gastos previstos marcaste como pagado?");
    expect(text).toContain("1) 19/09 · $\u00A02.500,00 · alquiler");
  });

  it("asks which expense to delete with numbered candidates", () => {
    const text = deleteAskReply([{ amount: 8000, note: "super", date: "2026-09-18" }]);
    expect(text).toContain("¿Cuál de estos gastos querés borrar?");
    expect(text).toContain("1) 18/09 · $\u00A08.000,00 · super");
  });

  it("builds the correction confirmation with the movement facts", () => {
    const text = movementCorrectionDoneReply("Transporte", 2500, "uber");
    expect(text).toContain("Transporte");
    expect(text).toContain(formatARS(2500));
  });

  it("builds the movement no-match reply", () => {
    expect(movementNoMatchReply()).toContain("No encontré ningún movimiento");
  });
});

describe("delete confirmation gate templates", () => {
  it("builds the delete confirmation naming the candidate facts", () => {
    const text = deleteConfirmReply(2500, "alquiler", "Alquiler");

    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
    expect(text).toContain("Alquiler");
    expect(text).toContain("Borrar");
  });

  it("builds the cancelled reply stating nothing was deleted", () => {
    expect(deleteCancelledReply()).toContain("cancelé");
    expect(deleteCancelledReply()).toContain("nada");
  });

  it("builds the pick-list reply listing the delete candidates", () => {
    const text = deletePickListReply([{ amount: 2500, note: "alquiler", date: "2026-09-19" }]);

    expect(text).toContain("¿Cuál");
    expect(text).toContain("borrar");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
  });
});

describe("quick-capture preview templates (v2)", () => {
  it("builds the v2 preview asking Guardamos with amount, note and the real type label", () => {
    const text = previewReply(30000, "gym", "REAL");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(30000));
    expect(text).toContain("gym");
    expect(text).toContain("real");
  });

  it("marks a PENDING preview as previsto", () => {
    const text = previewReply(2500, "alquiler", "PENDING");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
    expect(text).toContain("previsto");
  });

  it("labels an INGRESO preview as ingreso", () => {
    const text = previewReply(1000, null, "INGRESO");

    expect(text).toContain("¿Guardamos?");
    expect(text).toContain(formatARS(1000));
    expect(text).toContain("ingreso");
  });

  it("labels a COMPARTIDO preview as compartido", () => {
    const text = previewReply(2000, "super", "COMPARTIDO");

    expect(text).toContain("compartido");
  });

  it("never renders a pre-resolved category in the v2 preview text", () => {
    const text = previewReply(30000, "gym", "REAL");

    expect(text).not.toContain("Categoría");
  });

  it("builds the two-step confirmation with amount, note, type and category", () => {
    const text = previewConfirmReply(30000, "gym", "REAL", "Cafe");

    expect(text).toContain("Confirmá:");
    expect(text).toContain(formatARS(30000));
    expect(text).toContain("gym");
    expect(text).toContain("real");
    expect(text).toContain("Categoría: Cafe");
  });

  it("labels a PENDING confirmation as previsto", () => {
    const text = previewConfirmReply(2500, "alquiler", "PENDING", "Alquiler");

    expect(text).toContain("Confirmá:");
    expect(text).toContain(formatARS(2500));
    expect(text).toContain("alquiler");
    expect(text).toContain("previsto");
    expect(text).toContain("Categoría: Alquiler");
  });

  it("confirms an INGRESO without a note", () => {
    const text = previewConfirmReply(1000, null, "INGRESO", "Cafe");

    expect(text).toContain("ingreso");
    expect(text).toContain("Categoría: Cafe");
    expect(text).not.toContain("(");
  });

  it("builds the capture prompt asking for a short amount+note text", () => {
    const text = capturePromptReply();

    expect(text).toContain("monto");
    expect(text).toContain("nota");
  });
});