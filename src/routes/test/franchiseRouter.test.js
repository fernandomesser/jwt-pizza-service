const request = require("supertest");
const app = require("../../service.js");
const { Role, DB } = require("../../database/database.js");

let testUser;
let authToken;
let adminUser;
let adminToken;
let franchiseId;

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = {
    password: "toomanysecrets",
    roles: [{ role: Role.Admin }],
  };

  user.name = randomName();
  user.email = `${user.name}@admin.com`;

  user = await DB.addUser(user);

  return {
    ...user,
    password: "toomanysecrets",
  };
}

beforeAll(async () => {
  testUser = {
    name: "franchise tester",
    email: `${randomName()}@test.com`,
    password: "a",
  };

  const userResponse = await request(app)
    .post("/api/auth")
    .send(testUser);

  authToken = userResponse.body.token;
  testUser.id = userResponse.body.user.id;

  adminUser = await createAdminUser();

  const adminLogin = await request(app)
    .put("/api/auth")
    .send({
      email: adminUser.email,
      password: adminUser.password,
    });

  adminToken = adminLogin.body.token;
});

test("gets the list of franchises", async () => {
  const response = await request(app)
    .get("/api/franchise")
    .query({
      page: 0,
      limit: 10,
      name: "",
    });

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body.franchises)).toBe(true);
  expect(typeof response.body.more).toBe("boolean");
});

test("gets franchises for the authenticated user", async () => {
  const response = await request(app)
    .get(`/api/franchise/${testUser.id}`)
    .set("Authorization", `Bearer ${authToken}`);

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
});

test("admin creates a franchise", async () => {
  const response = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: randomName(),
      admins: [{ email: adminUser.email }],
    });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("id");

  franchiseId = response.body.id;
});

test("admin creates and deletes a store", async () => {
  const createResponse = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "SLC",
    });

  expect(createResponse.status).toBe(200);
  expect(createResponse.body).toHaveProperty("id");

  const deleteResponse = await request(app)
    .delete(
      `/api/franchise/${franchiseId}/store/${createResponse.body.id}`
    )
    .set("Authorization", `Bearer ${adminToken}`);

  expect(deleteResponse.status).toBe(200);
  expect(deleteResponse.body.message).toBe("store deleted");
});

test("deletes a franchise", async () => {
  const response = await request(app)
    .delete(`/api/franchise/${franchiseId}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe("franchise deleted");
});