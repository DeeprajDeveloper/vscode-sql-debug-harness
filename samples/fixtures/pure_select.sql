CREATE PROCEDURE dbo.usp_PureSelect
    @Id INT
AS
BEGIN
    SELECT Id, Name FROM dbo.Items WHERE Id = @Id;
END
