const request = require("supertest");
const app = require("../../service");

let testUser;
let authToken;

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

beforeAll(async () => {
  testUser = {
    name: "user tester",
    email: `${randomName()}@test.com`,
    password: "a",
  };

  const response = await request(app)
    .post("/api/auth")
    .send(testUser);

  testUser.id = response.body.user.id;
  authToken = response.body.token;
});

test("updates the authenticated user", async () => {
  const response = await request(app)
    .put(`/api/user/${testUser.id}`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      name: "updated user",
      email: testUser.email,
      password: "a",
    });

  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({
    id: testUser.id,
    name: "updated user",
    email: testUser.email,
  });
  expect(response.body.token).toBeDefined();
});

test("deletes a user", async () => {
  const response = await request(app)
    .delete(`/api/user/${testUser.id}`)
    .set("Authorization", `Bearer ${authToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe("not implemented");
});

test("lists users", async () => {
  const response = await request(app)
    .get("/api/user")
    .set("Authorization", `Bearer ${authToken}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    message: "not implemented",
    users: [],
    more: false,
  });
});

test("prevents a regular user from updating another user", async () => {
  const response = await request(app)
    .put(`/api/user/${testUser.id + 1}`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      name: "unauthorized update",
      email: "unauthorized@test.com",
      password: "a",
    });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe("unauthorized");
});