CREATE PROCEDURE dbo.usp_TempAndTableVar
    @Id INT
AS
BEGIN
    DECLARE @TV TABLE (Id INT);
    CREATE TABLE #Temp (Id INT);
    INSERT INTO @TV (Id) VALUES (@Id);
    INSERT INTO #Temp (Id) VALUES (@Id);
    UPDATE #Temp SET Id = @Id WHERE Id = @Id;
END
