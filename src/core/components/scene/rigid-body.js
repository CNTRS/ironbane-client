angular.module('components.scene.rigid-body', ['ces', 'three', 'ammo'])
    .config(function ($componentsProvider) {
        'use strict';

        $componentsProvider.addComponentData({
            'rigidBody': {
                mass: 1,
                shape: {
                    type: 'sphere',
                    radius: 1
                }
            }
        });
    })
    .factory('RigidBodySystem', function (System, THREE, Ammo, $rootWorld) {
        'use strict';

        // A lot of code here is based on Chandler Prall's Physijs
        // https://github.com/chandlerprall/Physijs/

        var activationStates = {
            RIGIDBODY_ACTIVE_TAG: 1,
            RIGIDBODY_ISLAND_SLEEPING: 2,
            RIGIDBODY_WANTS_DEACTIVATION: 3,
            RIGIDBODY_DISABLE_DEACTIVATION: 4,
            RIGIDBODY_DISABLE_SIMULATION: 5,
        };

        // Use pre-initalized bullet vars
        // so we can reuse them
        var btVec3a = new Ammo.btVector3(0, 0, 0);
        var btVec3b = new Ammo.btVector3(0, 0, 0);
        var btVec3c = new Ammo.btVector3(0, 0, 0);

        var btQuat = new Ammo.btQuaternion(0, 0, 0, 1);

        var btTransform = new Ammo.btTransform();

        // Cache for bullet shapes
        var objectShapes = {};
        var getShapeFromCache = function (key) {
            if (objectShapes[key] !== undefined) {
                return objectShapes[key];
            }
            return null;
        };

        var setShapeCache = function (key, shape) {
            objectShapes[key] = shape;
        };

        var nonCachedShapes = {};

        var createShape = function (description) {
            var cacheKey, shape;

            btTransform.setIdentity();
            switch (description.type) {
            case 'plane':
                cacheKey = 'plane_' + description.normal.x + '_' + description.normal.y + '_' + description.normal.z;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    btVec3a.setX(description.normal.x);
                    btVec3a.setY(description.normal.y);
                    btVec3a.setZ(description.normal.z);
                    shape = new Ammo.btStaticPlaneShape(btVec3a, 0);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'box':
                cacheKey = 'box_' + description.width + '_' + description.height + '_' + description.depth;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    btVec3a.setX(description.width / 2);
                    btVec3a.setY(description.height / 2);
                    btVec3a.setZ(description.depth / 2);
                    shape = new Ammo.btBoxShape(btVec3a);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'sphere':
                cacheKey = 'sphere_' + description.radius;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    shape = new Ammo.btSphereShape(description.radius);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'cylinder':
                cacheKey = 'cylinder_' + description.width + '_' + description.height + '_' + description.depth;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    btVec3a.setX(description.width / 2);
                    btVec3a.setY(description.height / 2);
                    btVec3a.setZ(description.depth / 2);
                    shape = new Ammo.btCylinderShape(btVec3a);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'capsule':
                cacheKey = 'capsule_' + description.radius + '_' + description.height;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    // In Bullet, capsule height excludes the end spheres
                    shape = new Ammo.btCapsuleShape(description.radius, description.height - 2 * description.radius);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'cone':
                cacheKey = 'cone_' + description.radius + '_' + description.height;
                if ((shape = getShapeFromCache(cacheKey)) === null) {
                    shape = new Ammo.btConeShape(description.radius, description.height);
                    setShapeCache(cacheKey, shape);
                }
                break;

            case 'concave':
                var i, triangle, triangleMesh = new Ammo.btTriangleMesh();
                if (!description.triangles.length) {
                    return false;
                }

                for (i = 0; i < description.triangles.length; i++) {
                    triangle = description.triangles[i];

                    btVec3a.setX(triangle[0].x);
                    btVec3a.setY(triangle[0].y);
                    btVec3a.setZ(triangle[0].z);

                    btVec3b.setX(triangle[1].x);
                    btVec3b.setY(triangle[1].y);
                    btVec3b.setZ(triangle[1].z);

                    btVec3c.setX(triangle[2].x);
                    btVec3c.setY(triangle[2].y);
                    btVec3c.setZ(triangle[2].z);

                    triangleMesh.addTriangle(
                        btVec3a,
                        btVec3b,
                        btVec3c,
                        true
                    );
                }

                shape = new Ammo.btBvhTriangleMeshShape(
                    triangleMesh,
                    true,
                    true
                );
                nonCachedShapes[description.id] = shape;
                break;

            case 'convex':
                var i, point, shape = new Ammo.btConvexHullShape; // jshint ignore:line
                for (i = 0; i < description.points.length; i++) {
                    point = description.points[i];

                    btVec3a.setX(point.x);
                    btVec3a.setY(point.y);
                    btVec3a.setZ(point.z);

                    shape.addPoint(btVec3a);
                }
                nonCachedShapes[description.id] = shape;
                break;

            case 'heightfield':

                var ptr = Ammo.allocate(4 * description.xpts * description.ypts, 'float', Ammo.ALLOC_NORMAL);

                for (var f = 0; f < description.points.length; f++) {
                    Ammo.setValue(ptr + f, description.points[f], 'float');
                }

                shape = new Ammo.btHeightfieldTerrainShape(
                    description.xpts,
                    description.ypts,
                    ptr,
                    1, -description.absMaxHeight,
                    description.absMaxHeight,
                    2,
                    0,
                    false
                );

                btVec3a.setX(description.xsize / (description.xpts - 1));
                btVec3a.setY(description.ysize / (description.ypts - 1));
                btVec3a.setZ(1);

                shape.setLocalScaling(btVec3a);
                nonCachedShapes[description.id] = shape;
                break;

            default:
                // Not recognized
                return;
            }

            return shape;
        };

        var RigidBodySystem = System.extend({
            addedToWorld: function (world) {
                var sys = this;

                sys._super(world);

                world.entityAdded('rigidBody').add(function (entity) {
                    var rigidBodyData = entity.getComponent('rigidBody');

                    var mass = rigidBodyData.mass;

                    var shape = createShape(rigidBodyData.shape);

                    var rigidBodyInfo;
                    var rigidBody;

                    shape.calculateLocalInertia(mass, btVec3a);

                    // TODO watch memory usage here! potential memory leak
                    // Ammo stuff must be cleaned up after use
                    btVec3a.setValue(entity.position.x, entity.position.y, entity.position.z);
                    btQuat.setValue(entity.quaternion.x, entity.quaternion.y, entity.quaternion.z, entity.quaternion.w);
                    var btTransform = new Ammo.btTransform(btQuat, btVec3a);
                    var state = new Ammo.btDefaultMotionState(btTransform);

                    btVec3a.setValue(0, 0, 0);
                    rigidBodyInfo = new Ammo.btRigidBodyConstructionInfo(mass, state, shape, btVec3a);
                    rigidBody = new Ammo.btRigidBody(rigidBodyInfo);

                    rigidBodyData.rigidBody = rigidBody;

                    $rootWorld.physicsWorld.addRigidBody(rigidBody);

                    // rigidBody.forceActivationState(activationStates.RIGIDBODY_ACTIVE_TAG);

                });

            },
            update: function (dt) {
                var world = this.world;
                var rigidBodies = world.getEntities('rigidBody');

                rigidBodies.forEach(function (entity) {

                    var rigidBodyComponent = entity.getComponent('rigidBody');

                    if (rigidBodyComponent) {
                        var trans = new Ammo.btTransform();
                        rigidBodyComponent.rigidBody.getMotionState().getWorldTransform(trans);
                        // console.log(trans.getOrigin().x());
                        console.log(trans.getOrigin().y());
                        // console.log(trans.getOrigin().z());
                        var origin = trans.getOrigin();

                        entity.position.setX(origin.x());
                        entity.position.setY(origin.y());
                        entity.position.setZ(origin.z());

                        // Fix for Quads to update their position
                        // as the attached entity now moved, causing
                        // a delay in the quad's position update
                        // Is there another way to solve this?
                        var quadComponent = entity.getComponent('quad');
                        if (quadComponent) {
                            var lookAtCameraScript = entity.getScript('/scripts/built-in/look-at-camera.js');
                            if (lookAtCameraScript) {
                                quadComponent.quad.position.copy(entity.position);
                            }
                        }

                    }

                });
                // console.log(dt);
            }
        });

        return RigidBodySystem;
    });
