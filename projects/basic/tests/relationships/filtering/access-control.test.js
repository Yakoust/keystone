const {
  Schema: {
    Types: { ObjectId },
  },
} = require('mongoose');
const { gen, sampleOne } = require('testcheck');
const { Text, Relationship } = require('@keystonejs/fields');
const { resolveAllKeys, mapKeys } = require('@keystonejs/utils');
const { setupServer, graphqlRequest } = require('../../util');

const alphanumGenerator = gen.alphaNumString.notEmpty();

let server;

// Random IDs
const postIds = ['gjfp463bxqtf', '43cg2hr9tmt3', '3qr8zpg7n4k6'];

function create(list, item) {
  // bypass the access control settings
  return server.keystone.getListByKey(list).adapter.create(item);
}

// AVA-like test wrapper for known failing tests
// see: https://github.com/avajs/ava#failing-tests
test.failing = (title, testFn) => {
  test(title, async () => {
    try {
      await testFn();
    } catch (error) {
      // Test is expected to fail
      return;
    }
    throw new Error(`Expected test '${title}' to fail. If this previously failing case now passes, consider removing '.failing' from the test definition`);
  });
};

beforeAll(() => {
  server = setupServer({
    name: 'Tests relationship field nested create many',
    createLists: keystone => {
      keystone.createList('UserToPostLimitedRead', {
        fields: {
          username: { type: Text },
          posts: { type: Relationship, ref: 'PostLimitedRead', many: true },
        },
      });

      keystone.createList('PostLimitedRead', {
        fields: {
          content: { type: Text },
        },
        access: {
          // Limit read access to the first post only
          read: { id_in: [postIds[1]] }
        },
      });
    },
  });

  server.keystone.connect();
});
/*
afterAll(() =>
  resolveAllKeys(
    mapKeys(server.keystone.adapters, adapter =>
      adapter.dropDatabase().then(() => adapter.close())
    )
  ));
  */

beforeEach(() =>
  // clean the db
  resolveAllKeys(
    mapKeys(server.keystone.adapters, adapter => adapter.dropDatabase())
  ));


// TODO: Test the case outlined in https://github.com/keystonejs/keystone-5/issues/224
describe('relationship filtering with access control', () => {
  test.failing('implicitly filters to only the IDs in the database by default', async () => {
    // FIXME: This test currently fails

    // Create all of the posts with the given IDs & random content
    await Promise.all(postIds.map(id => {
      const postContent = sampleOne(alphanumGenerator);
      return create('PostLimitedRead', { content: postContent, id: ObjectId(id) });
    }));

    // Create a user that owns 2 posts which are different from the one
    // specified in the read access control filter
    const username = sampleOne(alphanumGenerator);
    const user = await create('UserToPostLimitedRead', {
      username,
      posts: [ObjectId(postIds[1]), ObjectId(postIds[2])],
    });

    // Create an item that does the linking
    const queryUser = await graphqlRequest({
      server,
      query: `
        query {
          UserToPostLimitedRead(where: { id: "${user.id}" }) {
            id
            username
            posts {
              id
            }
          }
        }
      `,
    });

    expect(queryUser.body).not.toHaveProperty('errors');
    expect(queryUser.body.data).toMatchObject({
      UserToPostLimitedRead: {
        id: expect.any(String),
        username,
        posts: [
          { id: postIds[1] },
        ]
      },
    });
  });

  test('explicitly filters when given a `where` clause', async () => {
    // Create all of the posts with the given IDs & random content
    await Promise.all(postIds.map(id => {
      const postContent = sampleOne(alphanumGenerator);
      return create('PostLimitedRead', { content: postContent, id: ObjectId(id) });
    }));

    // Create a user that owns 2 posts which are different from the one
    // specified in the read access control filter
    const username = sampleOne(alphanumGenerator);
    const user = await create('UserToPostLimitedRead', {
      username,
      posts: [ObjectId(postIds[1]), ObjectId(postIds[2])],
    });

    // Create an item that does the linking
    const queryUser = await graphqlRequest({
      server,
      query: `
        query {
          UserToPostLimitedRead(where: { id: "${user.id}" }) {
            id
            username
            # Knowingly filter to an ID I don't have read access to
            # To see if the filter is correctly "AND"d with the access control
            posts(where: { id_in: ["${postIds[2]}"] }) {
              id
            }
          }
        }
      `,
    });

    expect(queryUser.body).not.toHaveProperty('errors');
    expect(queryUser.body.data).toMatchObject({
      UserToPostLimitedRead: {
        id: expect.any(String),
        username,
        posts: [],
      },
    });

  });
});
