CREATE PROCEDURE dbo.usp_TryCatchDml
    @Id INT
AS
BEGIN
    BEGIN TRY
        INSERT INTO dbo.T (Id) VALUES (@Id);
        UPDATE dbo.T SET V = 1 WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        SET @Id = 0;
    END CATCH
END
