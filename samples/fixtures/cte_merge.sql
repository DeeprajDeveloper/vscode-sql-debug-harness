CREATE PROCEDURE dbo.usp_CteMerge
AS
BEGIN
    ;WITH cte AS (SELECT 1 AS Id)
    SELECT * FROM cte;

    MERGE dbo.Target AS t
    USING dbo.Source AS s ON t.Id = s.Id
    WHEN MATCHED THEN UPDATE SET t.V = s.V
    WHEN NOT MATCHED THEN INSERT (Id, V) VALUES (s.Id, s.V);
END
