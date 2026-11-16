#!/usr/bin/env bash

host="${1%/}"

if [ -z "$host" ]; then
  echo "Usage: ./generatePizzaTraffic.sh https://YOUR-BACKEND-HOSTNAME"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install it before running this script."
  exit 1
fi

cleanup() {
  echo "Stopping traffic..."
  jobs -pr | xargs -r kill 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM

request_menu() {
  while true; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$host/api/order/menu")
    echo "Requesting menu... $status"
    sleep 3
  done
}

invalid_login() {
  while true; do
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT "$host/api/auth" \
      -H 'Content-Type: application/json' \
      -d '{"email":"unknown@jwt.com","password":"bad"}')
    echo "Logging in with invalid credentials... $status"
    sleep 25
  done
}

successful_order() {
  while true; do
    response=$(curl -s -X PUT "$host/api/auth" \
      -H 'Content-Type: application/json' \
      -d '{"email":"d@jwt.com","password":"diner"}')
    token=$(echo "$response" | jq -r '.token // empty')

    if [ -n "$token" ]; then
      status=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$host/api/order" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" \
        -d '{"franchiseId":1,"storeId":1,"items":[{"menuId":1,"description":"Veggie","price":0.05}]}')
      echo "Bought a pizza... $status"
      sleep 20
      curl -s -o /dev/null -X DELETE "$host/api/auth" \
        -H "Authorization: Bearer $token"
      echo "Logged out."
    else
      echo "Diner login failed; check that the database is seeded."
    fi

    sleep 30
  done
}

failed_order() {
  while true; do
    response=$(curl -s -X PUT "$host/api/auth" \
      -H 'Content-Type: application/json' \
      -d '{"email":"d@jwt.com","password":"diner"}')
    token=$(echo "$response" | jq -r '.token // empty')

    if [ -n "$token" ]; then
      items=$(jq -cn '[range(0;21)|{"menuId":1,"description":"Veggie","price":0.05}]')
      status=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$host/api/order" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" \
        -d "{\"franchiseId\":1,\"storeId\":1,\"items\":$items}")
      echo "Tried ordering too many pizzas... $status"
      curl -s -o /dev/null -X DELETE "$host/api/auth" \
        -H "Authorization: Bearer $token"
    else
      echo "Diner login failed; check that the database is seeded."
    fi

    sleep 300
  done
}

request_menu &
invalid_login &
successful_order &
failed_order &

echo "Generating traffic for $host. Press Ctrl+C to stop."
wait