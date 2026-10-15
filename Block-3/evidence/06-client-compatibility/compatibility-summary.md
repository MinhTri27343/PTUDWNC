# Part 3 compatibility evidence

## Contracts

- v1 has no remaining_stock.
- v2 adds remaining_stock with tag 4.
- Existing field tags, types and meanings are unchanged.

## Client v1 with server v2

- Client version: v1.
- Server version: v2.
- Result: success=true.
- Order status: COMPLETED.
- Client does not read remaining_stock and ignores the unknown field.

Evidence: old-client-with-new-server.json.

## Client v2 with server v2

- Client version: v2.
- Server version: v2.
- Result: success=true.
- remaining_stock read by client: 8.
- Order status: COMPLETED.

Evidence: new-client-with-new-server.json.

## Field absence policy

A proto3 scalar without presence cannot distinguish wire absence from the
default value 0. Therefore the client treats 0 or an absent value as
unknown_or_zero and does not infer that stock is definitely zero.

Details about how each client is loaded from its proto are in
client-build-info.md.
