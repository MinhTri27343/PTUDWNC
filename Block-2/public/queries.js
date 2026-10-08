export const queries = {
  web: 'query WebDashboard($user_id: ID!) { user(id: $user_id) { id name orders { id user_id product_id status quantity total_cents created_at product { id name price_cents thumbnail_url } } } }',
  mobile: 'query MobileOrders($user_id: ID!) { user(id: $user_id) { orders { id status product { name thumbnail_url } } } }'
};
