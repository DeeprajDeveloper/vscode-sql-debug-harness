CREATE PROCEDURE dbo.usp_UpdateJoin
    @OrderId INT
AS
BEGIN
    UPDATE i
    SET i.StockQuantity = i.StockQuantity - oi.Quantity
    FROM dbo.Inventory i
    JOIN dbo.OrderItems oi ON i.ProductID = oi.ProductID
    WHERE oi.OrderID = @OrderId;
END
