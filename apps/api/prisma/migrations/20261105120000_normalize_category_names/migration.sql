-- Canonical category names: uppercase, no diacritics (ñ kept, it is a letter).
-- A shared expense copies the registrant's spelling into the partner's row, so
-- "Carniceria" and "carnicería" coexisted and their dashboard cards never
-- matched. From now on the API writes this shape and this backfill aligns the
-- rows that predate it. Verified beforehand: no owner has two categories that
-- collapse into the same canonical name.

UPDATE "Category" AS c
SET name = n.canonical
FROM (
  SELECT
    id,
    upper(
      translate(
        name,
        'áàäâãéèëêíìïîóòöôõúùüûÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛ',
        'aaaaaeeeeiiiiooooouuuuAAAAAEEEEIIIIOOOOOUUUU'
      )
    ) AS canonical
  FROM "Category"
) AS n
WHERE c.id = n.id
  AND c.name <> n.canonical;

UPDATE "Expense" AS e
SET "category" = n.canonical
FROM (
  SELECT
    id,
    upper(
      translate(
        "category",
        'áàäâãéèëêíìïîóòöôõúùüûÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛ',
        'aaaaaeeeeiiiiooooouuuuAAAAAEEEEIIIIOOOOOUUUU'
      )
    ) AS canonical
  FROM "Expense"
  WHERE "category" IS NOT NULL
) AS n
WHERE e.id = n.id
  AND e."category" <> n.canonical;
