# Failure-mode evidence

- Insufficient stock is a gRPC response message and maps to HTTP 409.
- A gRPC deadline exceeded maps to HTTP 504 INVENTORY_TIMEOUT.
- An unavailable Inventory Service maps to HTTP 502 INVENTORY_UNAVAILABLE.
- All failure cases finish within a finite time and do not create orders.
- Logs are stored in evidence/07-failure-handling/order-api-failure-modes.log
  and evidence/07-failure-handling/inventory-failure-modes.log.
