-- Simple INSERT / UPDATE / DELETE for rewrite tests
CREATE PROCEDURE dbo.usp_SimpleDml
    @Id INT,
    @Name NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.Items (Id, Name) VALUES (@Id, @Name);
    UPDATE dbo.Items SET Name = @Name WHERE Id = @Id;
    DELETE FROM dbo.Items WHERE Id = @Id;
END
