const request = require("supertest");
const app = require("../../service");

test("gets the pizza menu", async () => {
  const response = await request(app).get("/api/order/menu");

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
});