CREATE PROCEDURE dbo.usp_DynamicAndCursor
AS
BEGIN
    DECLARE @sql NVARCHAR(MAX) = N'SELECT 1';
    EXEC(@sql);
    EXEC sp_executesql @sql;

    DECLARE cur CURSOR FOR SELECT Id FROM dbo.T;
    OPEN cur;
    WHILE 1 = 1
    BEGIN
        UPDATE dbo.T SET V = 1 WHERE Id = 1;
        BREAK;
    END
    CLOSE cur;
    DEALLOCATE cur;
END
