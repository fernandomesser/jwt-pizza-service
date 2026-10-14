const request = require("supertest");
const app = require("../../service");
const { Role, DB } = require("../../database/database");
const { setAuth } = require("../authRouter");

let testUser;
let authToken;
let adminToken;
let listingPrefix;

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

beforeAll(async () => {
  listingPrefix = `listing-${randomName()}`;
  testUser = {
    name: `${listingPrefix} first`,
    email: `${randomName()}@test.com`,
    password: "a",
  };

  const response = await request(app)
    .post("/api/auth")
    .send(testUser);

  testUser.id = response.body.user.id;
  authToken = response.body.token;

  await request(app).post("/api/auth").send({
    name: `${listingPrefix} second`,
    email: `${randomName()}@test.com`,
    password: "a",
  });

  const admin = await DB.addUser({
    name: `${listingPrefix} admin`,
    email: `${randomName()}@admin.com`,
    password: "a",
    roles: [{ role: Role.Admin }],
  });
  adminToken = await setAuth(admin);
});

test("updates the authenticated user", async () => {
  const updatedEmail = `${randomName()}@updated.test`;
  const response = await request(app)
    .put(`/api/user/${testUser.id}`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({
      name: `${listingPrefix} first updated`,
      email: updatedEmail,
      password: "updated-password",
    });

  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({
    id: testUser.id,
    name: `${listingPrefix} first updated`,
    email: updatedEmail,
  });
  expect(response.body.token).toBeDefined();

  const login = await request(app).put("/api/auth").send({ email: updatedEmail, password: "updated-password" });
  expect(login.status).toBe(200);
  expect(login.body.user.id).toBe(testUser.id);
});

test("requires an admin to delete a user", async () => {
  const response = await request(app)
    .delete(`/api/user/${testUser.id}`)
    .set("Authorization", `Bearer ${authToken}`);

  expect(response.status).toBe(403);
});

test("requires an admin to list users", async () => {
  const response = await request(app)
    .get("/api/user")
    .set("Authorization", `Bearer ${authToken}`);

  expect(response.status).toBe(403);
});

test("lists and filters users with pagination", async () => {
  const response = await request(app)
    .get(`/api/user?page=1&limit=1&name=${listingPrefix}`)
    .set("Authorization", `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.users).toHaveLength(1);
  expect(response.body.users[0]).toMatchObject({ name: `${listingPrefix} admin`, email: expect.any(String), roles: [{ role: "admin" }] });
  expect(response.body.users[0].password).toBeUndefined();
  expect(response.body.more).toBe(true);

  const nextPage = await request(app)
    .get(`/api/user?page=2&limit=1&name=${listingPrefix}`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(nextPage.status).toBe(200);
  expect(nextPage.body.users).toHaveLength(1);
  expect(nextPage.body.more).toBe(true);
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

test("admin deletes a user", async () => {
  const response = await request(app)
    .delete(`/api/user/${testUser.id}`)
    .set("Authorization", `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe("user deleted");

  const remaining = await request(app)
    .get(`/api/user?page=1&limit=10&name=${listingPrefix} first updated`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(remaining.body.users).toHaveLength(0);
});
